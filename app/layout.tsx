import type { Metadata } from "next";
import "./globals.css";

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
