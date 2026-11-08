export default function PlaceholderPage({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-3xl font-bold">{title}</h1>
      <p className="text-muted">{note}</p>
    </div>
  )
}