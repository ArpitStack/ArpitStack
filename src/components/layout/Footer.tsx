export function Footer() {
  return (
    <footer className="border-t border-stone-200 py-10">
      <div className="mx-auto max-w-6xl px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="font-serif text-lg text-stone-900">Arpit Gupta</p>
        <p className="text-sm text-stone-500">
          © {new Date().getFullYear()} · Gurugram, India
        </p>
      </div>
    </footer>
  );
}
