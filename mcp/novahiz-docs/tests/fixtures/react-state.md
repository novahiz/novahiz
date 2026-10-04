# React State Guide

Overview of the state primitives available to components in this model.

## useState hook

Call `useState()` inside a component to declare one piece of state. The call
returns the current value and a setter that schedules a re-render when called.

```js
const [count, setCount] = useState(0);
setCount(count + 1);
```

The setter accepts a plain value or an updater function. The updater receives
the previous state and must stay free of side effects, because it can be
invoked twice under strict rendering.

## useReducer hook

`useReducer()` keeps one state object and dispatches actions through a reducer
function. Pick it when several values move together or when the next state
depends on the previous one.

```js
const [state, dispatch] = useReducer(reducer, { count: 0 });
dispatch({ type: "increment" });
```

The reducer is pure: same action in, same next state out. Put asynchronous
work outside of it and dispatch when the result arrives.

## Deriving state

Store the smallest possible state and compute the rest during render. A value
that can be produced from existing state with a plain expression should never
be duplicated into another effect or another state variable.
