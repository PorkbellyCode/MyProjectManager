export function SectionHeader({ id, title, description }: { id: string; title: string; description?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-1.5">
      <h2 id={id} className="text-xl font-semibold leading-[1.4]">
        {title}
      </h2>
      {description && <p className="max-w-prose text-sm leading-[1.75] text-muted-text">{description}</p>}
    </div>
  );
}
