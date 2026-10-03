import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata = {
  title: 'Ticket Manager',
  description: 'Internal ticketing system',
};

export default function RootLayout({ children }) {
  return (
    // Browser extensions stamp their own data-* attributes onto <html> before
    // React hydrates, which React reports as a mismatch it cannot patch. The
    // element carries nothing of ours that depends on the client, so the
    // difference is safe to ignore.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
