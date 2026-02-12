import { NextRequest, NextResponse } from "next/server";
import { sellPosition } from "@/lib/copy-trade";

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const MY_ADDRESS = process.env.MY_ADDRESS ?? "0x370e81c93aa113274321339e69049187cce03bb9";
const SIGNATURE_TYPE = parseInt(process.env.SIGNATURE_TYPE ?? "1", 10);

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!PRIVATE_KEY) {
    return NextResponse.json({ error: "PRIVATE_KEY not configured" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { asset, size, price } = body as { asset: string; size: number; price: number };
    if (!asset || !size || size <= 0) {
      return NextResponse.json({ error: "asset and size required" }, { status: 400 });
    }

    const result = await sellPosition(
      PRIVATE_KEY,
      MY_ADDRESS,
      SIGNATURE_TYPE,
      asset,
      size,
      price ?? 0.5
    );

    if (!result.success) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: err }, { status: 500 });
  }
}
