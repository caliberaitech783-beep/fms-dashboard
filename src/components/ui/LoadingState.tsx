export function LoadingState() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="h-28 animate-pulse rounded-lg border border-coal-200 bg-white" />
      ))}
    </div>
  );
}
