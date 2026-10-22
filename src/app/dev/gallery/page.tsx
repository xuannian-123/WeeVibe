import { notFound } from "next/navigation";
import Gallery from "./GalleryClient";

// 图库里全是假数据，生产环境关掉，避免路演时误把 fixture 当真实数据展示
export default function GalleryPage() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_GALLERY !== "1") notFound();
  return <Gallery />;
}
