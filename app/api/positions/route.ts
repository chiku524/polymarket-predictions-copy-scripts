import { NextResponse } from "next/server";
import { getPositions, getClosedPositions } from "@/lib/polymarket";

const MY_ADDRESS = process.env.MY_ADDRESS ?? "0x370e81c93aa113274321339e69049187cce03bb9";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const [open, closed] = await Promise.all([
      getPositions(MY_ADDRESS, 100),
      getClosedPositions(MY_ADDRESS, 50),
    ]);
    const active = open.filter((p) => !p.redeemable);
    const resolved = [...open.filter((p) => p.redeemable), ...closed];
    return NextResponse.json(
      { active, resolved },
      { headers: { "Cache-Control": "no-store, no-cache, max-age=0" } }
    );
  } catch (e) {
    console.error("Positions error:", e);
    return NextResponse.json(
      { error: "Failed to load positions" },
      { status: 500 }
    );
  }
}
