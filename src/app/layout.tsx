import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cipher War",
  description:
    "Four intelligence agencies, one shared ether. Intercept, decrypt, and finish your operation first.",
  manifest: "/manifest.webmanifest",
  applicationName: "Cipher War",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Cipher War" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#05070c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Loaded via link rather than next/font so a clone builds offline too. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      {/* Wallet extensions inject attributes and nodes into <body> before React
          hydrates, which React reports as a mismatch even though nothing in the
          app differs. This suppresses that one comparison; it does not hide
          mismatches inside the app's own tree. */}
      <body className="min-h-full antialiased" suppressHydrationWarning>
        {children}
        {/*
          The service worker is a PRODUCTION-ONLY concern.

          It serves /_next/static/* cache-first, which is safe in production
          because those filenames are content-hashed. In development they are
          not — `main-app.js` keeps its name across rebuilds — so the worker
          happily pairs fresh HTML with stale JavaScript and you end up staring
          at an old build wondering why your changes vanished.

          In dev we therefore do the opposite of registering: tear down any
          worker a previous run installed and drop its caches, otherwise a
          developer who ever loaded the app in production mode stays poisoned.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              process.env.NODE_ENV === "production"
                ? `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}`
                : `if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister()})}).catch(function(){});if(window.caches){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k)})}).catch(function(){})}}`,
          }}
        />
      </body>
    </html>
  );
}
