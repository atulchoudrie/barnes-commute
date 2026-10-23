import { ImageResponse } from "next/og";

// Home-screen icon, square PNG at /api/icon/<size> (180 for iPhone, 192 and 512 for Android).
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Math.min(1024, Math.max(32, Number((await params).size) || 192));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0a7aff", color: "white" }}>
        <div style={{ fontSize: size * 0.5, fontWeight: 700, lineHeight: 1 }}>B</div>
        <div style={{ fontSize: size * 0.14, fontWeight: 700, letterSpacing: size * 0.01, marginTop: size * 0.04 }}>WAT</div>
      </div>
    ),
    { width: size, height: size },
  );
}
