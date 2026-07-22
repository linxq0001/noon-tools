import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Chakra_Petch } from "next/font/google";
import AppShell from "@/components/app-shell";

export const metadata = {
  title: "Noon Tools",
  description: "Local operations workspace for Noon tools",
};

const chakraPetch = Chakra_Petch({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-chakra",
  display: "swap",
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`${GeistSans.variable} ${GeistMono.variable} ${chakraPetch.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
