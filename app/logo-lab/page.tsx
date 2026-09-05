import type { Metadata } from "next";
import { LogoLab } from "@/components/LogoLab";

export const metadata: Metadata = {
  title: "Logo explorations",
  robots: { index: false, follow: false },
};

export default function LogoLabPage() {
  return <LogoLab />;
}
