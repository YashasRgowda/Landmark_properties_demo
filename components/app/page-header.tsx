/** Every page opens the same way: what it is, and in one line, what it is for. */
export function PageHeader({ title, description, actions, eyebrow }: {
  title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-2">
      <div className="space-y-1">
        {eyebrow && <p className="text-xs font-medium tracking-wider text-amber-800/80 uppercase">{eyebrow}</p>}
        <h1 className="text-3xl font-semibold text-foreground">{title}</h1>
        {description && <p className="text-muted-foreground max-w-2xl text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
