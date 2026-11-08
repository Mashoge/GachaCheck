export function messageOf(err: unknown) {
  return (err as { message?: string } | null)?.message ?? 'Something went wrong'
}