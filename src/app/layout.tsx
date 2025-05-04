import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"; // Import Toaster
// Removed QueryClientProvider as it's not directly used in the Firestore refactor
// If you add features that use Tanstack Query later, you'll need to re-add it.
// import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Math Mania', // Update title
  description: 'Fastest finger math game', // Update description
};

// const queryClient = new QueryClient(); // Removed instantiation

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* <QueryClientProvider client={queryClient}> */}
          <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-secondary">
            {children}
          </main>
          <Toaster /> {/* Add Toaster component */}
        {/* </QueryClientProvider> */}
      </body>
    </html>
  );
}
