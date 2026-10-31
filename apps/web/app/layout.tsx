import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";
import "./rift.css";
import "./rift-panels.css";
import { ObservatoryProvider } from "@/components/provider";

export const metadata: Metadata = {
  title: {
    default: "Parallax | The Rift",
    template: "%s | Parallax",
  },
  description:
    "An event-driven research terminal connecting prediction-market odds and Solana perpetuals. Not financial advice.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <ObservatoryProvider>{children}</ObservatoryProvider>
      </body>
    </html>
  );
}
