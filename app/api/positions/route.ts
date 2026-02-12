import { NextResponse } from "next/server";
import { getPositions } from "@/lib/polymarket";

const MY_ADDRESS = process.env.MY_ADDRESS ?? "0x370e81c93aa113274321339e69049187cce03bb9";

export async function GET() {
  try {
    const positions = await getPositions(MY_ADDRESS, 50);
    return NextResponse.json(positions);
  } catch (e) {
    console.error("Positions error:", e);
    return NextResponse.json(
      { error: "Failed to load positions" },
      { status: 500 }
    );
  }
}
