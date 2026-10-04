# Query Client Handbook

The query client keeps remote data cached, fresh, and shared between every
component that asks for the same key.

## useQuery hook

`useQuery()` subscribes a component to one cache entry. It returns the current
data, a loading flag, and the error from the last attempt, and it re-renders
the component whenever the entry changes.

```js
const { data, isPending, error } = useQuery({
  queryKey: ["todos"],
  queryFn: loadTodos
});
```

While a key is mounted, the client keeps it fresh according to the staleness
time and refetches when the window regains focus.

## Cache and stale time

The cache stores one entry per key. An entry older than the staleness time is
reported as stale and refreshed in the background, so readers keep the last
known data instead of an empty screen.

```js
const client = new QueryClient({ defaultOptions: {
  queries: { staleTime: 30_000, retry: 1 }
}});
```

Set a longer staleness for data that rarely changes, a shorter one for feeds
that move between two requests. Manual invalidation always wins over the
timer: invalidate a key to refetch every subscriber at once.

## Mutations

A mutation writes to the server and invalidates the keys it affected. Await
the mutation before invalidating so the refetch reads the version you just
wrote.

```js
await client.invalidateQueries({ queryKey: ["todos"] });
```
