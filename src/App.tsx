import { useEffect, useState } from 'react';
import Library from './components/Library';
import PlayerView from './components/PlayerView';
import { seedDemoIfNeeded } from './lib/library';

function routeFromHash(): { id: string; edit: boolean } | null {
  const m = location.hash.match(/^#\/song\/([\w-]+)(\/edit)?/);
  return m ? { id: m[1], edit: !!m[2] } : null;
}

export default function App() {
  const [route, setRoute] = useState(routeFromHash);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    seedDemoIfNeeded()
      .catch((e) => console.error('Could not add demo song', e))
      .finally(() => setSeeded(true));
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!seeded) return null;
  return route ? <PlayerView key={route.id} songId={route.id} startEditing={route.edit} /> : <Library />;
}

export function openSong(id: string, edit = false) {
  location.hash = `#/song/${id}${edit ? '/edit' : ''}`;
}

export function openLibrary() {
  location.hash = '#/';
}
