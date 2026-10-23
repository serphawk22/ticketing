import { Inter, Sora } from 'next/font/google';
import './globals.css';
import { getSession } from '@/lib/auth';
import { getAllWorkspaces } from '@/lib/workspaces';
import WorkspacesProvider from '@/components/WorkspacesProvider';
import ThemeProvider from '@/components/ThemeProvider';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

const sora = Sora({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-sora',
  display: 'swap',
});

export const metadata = {
  title: 'Ticket Manager',
  description: 'Internal ticketing system',
};

export default async function RootLayout({ children }) {
  const session = await getSession();
  const workspaces =
    session && session.user.role !== 'client' ? await getAllWorkspaces() : [];

  return (
    // Browser extensions stamp their own data-* attributes onto <html> before
    // React hydrates, which React reports as a mismatch it cannot patch. The
    // element carries nothing of ours that depends on the client, so the
    // difference is safe to ignore.
    <html
      lang="en"
      className={`${inter.variable} ${sora.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <ThemeProvider>
          <WorkspacesProvider workspaces={workspaces}>
            {children}
          </WorkspacesProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
