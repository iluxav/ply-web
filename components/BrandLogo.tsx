import Image from "next/image";

type BrandLogoProps = {
  theme?: "dark" | "light";
};

export function BrandLogo({ theme = "dark" }: BrandLogoProps) {
  return (
    <Image
      src={`/brand/wordmark-${theme}.svg`}
      alt="ply"
      width={100}
      height={36}
      unoptimized
    />
  );
}
