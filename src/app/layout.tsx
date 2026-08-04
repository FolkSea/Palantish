import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { BookmarksProvider } from "@/components/BookmarksProvider";
import { listBookmarkIds } from "@/app/bookmark-actions";
import { ViewerRoleProvider } from "@/components/ViewerRoleProvider";
import { getAuthenticatedClient, isAdministrator } from "@/lib/auth";

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
  // Seeded alongside, so a control an administrator alone may use is not shown
  // to everyone else for a frame and then removed.
  const auth = await getAuthenticatedClient();
  const administrator = auth ? isAdministrator(auth.role) : false;

  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full">
        <ViewerRoleProvider isAdministrator={administrator}>
          <BookmarksProvider initialIds={bookmarkIds}>
            {children}
          </BookmarksProvider>
        </ViewerRoleProvider>
      </body>
    </html>
  );
}
