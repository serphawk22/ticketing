import './globals.css';

export const metadata = {
  title: 'Ticket Manager',
  description: 'Internal ticketing system',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}