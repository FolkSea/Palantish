import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { BookmarksProvider } from "@/components/BookmarksProvider";
import { listBookmarkIds } from "@/app/bookmark-actions";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Palantish",
  description:
    "An intelligence portal with the confidence of an all-seeing stone and the caveats of a responsible analyst.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Seeded here so a saved report never renders as unsaved for a frame, and so
  // every list on the page shares one state: saving in one updates the rest.
  // Empty for a signed-out visitor, which is what /login wants anyway.
  const bookmarkIds = await listBookmarkIds();

  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full">
        <BookmarksProvider initialIds={bookmarkIds}>{children}</BookmarksProvider>
      </body>
    </html>
  );
}
