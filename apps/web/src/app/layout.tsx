import type { Metadata } from 'next';
import Link from 'next/link';
import { Geist, Geist_Mono } from 'next/font/google';
import { TooltipProvider } from '../components/ui/tooltip';
import './globals.css';

const geistSans = Geist({
  variable: '--font-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Make Your Case',
  description: 'See the structure behind any argument, and find out exactly what it depends on.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider>
          <header className="border-b">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
              <Link href="/" className="font-heading text-base font-semibold">
                Make Your Case
              </Link>
              {/* Standing guardrail (AGENTS.md section 1): supplementary, never dispositive. */}
              <p className="text-sm text-muted-foreground">
                Supplementary analysis of the reasoning in a text. It is not a judgment about any
                person.
              </p>
            </div>
          </header>
          <main className="flex flex-1 flex-col">{children}</main>
        </TooltipProvider>
      </body>
    </html>
  );
}
