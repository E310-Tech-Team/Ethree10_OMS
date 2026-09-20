export const dynamic = "force-dynamic";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Transparent on purpose: the ambient field lives on <body>, and any opaque
  // layer here paints over the thing the glass refracts.
  return (
    <div className="flex min-h-screen items-center justify-center">
      {children}
    </div>
  );
}
