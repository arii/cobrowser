import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = { title: "Cerebral", description: "Verified browser skills" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">Cerebral</Link>
          <nav>
            <Link href="/">Skills</Link>
            <Link href="/demo">Demonstrate</Link>
            <Link href="/eval">Eval</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
