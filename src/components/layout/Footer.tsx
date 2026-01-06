export function Footer() {
  return (
    <footer className="py-8 bg-background border-t border-border/40">
      <div className="container mx-auto px-4 text-center">
        <p className="text-sm text-muted-foreground">
          © {new Date().getFullYear()} Arpit Gupta. All rights reserved.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Built with React, Vite, Tailwind & Shadcn UI.
        </p>
      </div>
    </footer>
  );
}
