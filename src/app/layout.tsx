import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relo OS",
  description: "The operating layer for relocation management companies",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-neutral-50 text-neutral-900">{children}</body>
    </html>
  );
}
