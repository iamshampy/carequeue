import type { Metadata } from 'next';
import './globals.css';
import './layout-overrides.css';
export const metadata: Metadata = { title: 'CareQueue — A better way to see your doctor', description: 'A calmer way to find, book, and see local doctors.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

