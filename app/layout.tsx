import type { Metadata } from "next";
import "./globals.css";
import "./room.css";
import "./table-layout.css";
import "./club.css";
import "./table-tactile.css";

export const metadata: Metadata = {
  title: "River Room — A good hand. A great time.",
  description: "Play Texas Hold’em with friends. Share a room code and settle in. Always play money.",
  icons: {
    icon: "/river.svg",
    shortcut: "/river.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
import "./club-hub.css";
import "./tournament.css";
