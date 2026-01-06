import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { CommandPalette } from "@/components/command-palette";
import { Background } from "@/components/layout/Background";
import { Spotlight } from "@/components/ui/spotlight";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex flex-col min-h-screen">
      <Background />
      <Spotlight />
      <Navbar />
      <CommandPalette />
      <main className="flex-grow">
        {children}
      </main>
      <Footer />
    </div>
  );
}
