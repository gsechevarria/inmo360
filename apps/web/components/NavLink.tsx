"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, label, children, className = "" }: { href: string; label: string; children: React.ReactNode; className?: string }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} title={label}
      className={`${className} flex flex-col items-center gap-0.5 px-2 py-1.5 text-[10.5px] text-white/75 hover:text-white md:mx-2 md:flex-row md:gap-3 md:rounded-md md:px-2 md:py-2 md:text-[13px] md:hover:bg-white/10 ${active ? "text-white md:bg-white/15" : ""}`}>
      {children}
      <span className="md:hidden lg:inline">{label}</span>
    </Link>
  );
}
