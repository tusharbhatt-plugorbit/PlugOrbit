/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';
import {TestApp, probe, seedSignedIn} from '../src/dev/testHarness';
import type {Route} from '../src/domain/types';
import {LEAFLET_JS, LEAFLET_VERSION} from '../src/maps/leafletAsset';
import {buildMapHtml} from '../src/maps/osmMapHtml';
import {RouteMap, StationMiniMap} from '../src/ui';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

// Google config as an Android build with no Maps key would see it: the
// OpenStreetMap fallback is drawn instead of the Google map.
jest.mock('../src/config/google', () => ({
  ...jest.requireActual('../src/config/google'),
  mapsKeyMissing: true,
}));

declare var global: {
  __WEBVIEW_JS?: string[];
  __WEBVIEW_MISSING?: boolean;
  __WEBVIEW_MOUNTS?: number;
};

const mounted: Renderer[] = [];
beforeEach(() => {
  global.__WEBVIEW_JS = [];
  global.__WEBVIEW_MISSING = false;
  global.__WEBVIEW_MOUNTS = 0;
});
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

const texts = (r: Renderer) =>
  r.root
    .findAll(n => n.type === Text)
    .map(n => ([] as unknown[]).concat(n.props.children).join(''));

/** The (mock) WebView host node: the page, as far as React Native can see. */
const isPage = (n: ReactTestRenderer.ReactTestInstance) =>
  n.props.testID === 'osm-webview' && (n.type as unknown) === 'View';
const page = (r: Renderer) => r.root.find(isPage);
const hasPage = (r: Renderer) => r.root.findAll(isPage).length > 0;

/** Plays the page's side of the conversation. */
async function say(r: Renderer, message: object) {
  await act(async () => {
    page(r).props.onMessage({nativeEvent: {data: JSON.stringify(message)}});
  });
}

type SentState = {
  pins: {id: string; kind: string; selected?: boolean}[];
  route: {points: number[][]; width: number} | null;
};
/** What the app last told the page to draw. */
function lastState(): SentState {
  const calls = (global.__WEBVIEW_JS ?? []).filter(c =>
    c.includes('window.PO.set('),
  );
  const call = calls[calls.length - 1];
  const json = call.match(/window\.PO\.set\((.*)\)\}catch/s)![1];
  return JSON.parse(json);
}
const calls = (what: string) =>
  (global.__WEBVIEW_JS ?? []).filter(c => c.includes(what));

describe('Home without a Maps key', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  async function openHome(): Promise<Renderer> {
    seedSignedIn();
    let r!: Renderer;
    await act(async () => {
      r = ReactTestRenderer.create(<TestApp tab="Home" />);
    });
    mounted.push(r);
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        jest.advanceTimersByTime(60);
      });
    }
    return r;
  }

  test('draws the fallback map instead of a grey one or an apology', async () => {
    const r = await openHome();
    expect(hasPage(r)).toBe(true);
    // No Google map is created, and nothing says the map is unavailable.
    expect(r.root.findAll(n => n.props.testID === 'map')).toHaveLength(0);
    expect(texts(r)).not.toContain('Map isn’t available');
  });

  test('loads the page from an https address, so tile requests carry a Referer', async () => {
    // A page built from an HTML string has no address of its own and would send
    // no Referer; OpenStreetMap's tile servers refuse such requests.
    const r = await openHome();
    const {source} = page(r).props;
    expect(source.html).toContain('<!DOCTYPE html>');
    expect(source.baseUrl).toMatch(/^https:\/\/[^/\s]+/);
  });

  test('hands the chargers and the camera to the page once it is ready', async () => {
    const r = await openHome();
    // Nothing is sent to a page that has not started.
    expect(calls('window.PO.set(')).toHaveLength(0);
    await say(r, {type: 'ready'});
    const state = lastState();
    expect(state.pins.filter(p => p.kind === 'charger').length).toBeGreaterThan(
      1,
    );
    // Plus the blue "you are here" dot, since the device location is known.
    expect(state.pins.filter(p => p.kind === 'me')).toHaveLength(1);
    // The move to the search origin that Home asked for before the page was up.
    expect(calls('window.PO.view(').length).toBeGreaterThan(0);
  });

  test('tapping a pin selects that charger, tapping the map clears it', async () => {
    const r = await openHome();
    await say(r, {type: 'ready'});
    const other = lastState().pins.find(p => !p.selected)!;
    await say(r, {type: 'marker', id: other.id});
    const picked = lastState().pins.filter(p => p.selected);
    expect(picked.map(p => p.id)).toEqual([other.id]);

    await say(r, {type: 'press'});
    expect(lastState().pins.some(p => p.selected)).toBe(false);
  });

  test('panning far from the search area offers to search there', async () => {
    const r = await openHome();
    await say(r, {type: 'ready'});
    expect(texts(r)).not.toContain('Search this area');
    await say(r, {type: 'move', lat: 28.9, lng: 77.5});
    expect(texts(r)).toContain('Search this area');
  });

  test('says so, with a Reload, when the map tiles cannot load', async () => {
    const r = await openHome();
    await say(r, {type: 'ready'});
    await say(r, {type: 'tiles', ok: false});
    expect(texts(r)).toContain('Couldn’t load the map. Check your connection.');
    const mounts = global.__WEBVIEW_MOUNTS ?? 0;
    const reload = r.root.find(
      n =>
        n.props.accessibilityLabel === 'Reload map' &&
        typeof n.props.onPress === 'function',
    );
    await act(async () => reload.props.onPress());
    expect(global.__WEBVIEW_MOUNTS).toBeGreaterThan(mounts);
    expect(texts(r)).not.toContain(
      'Couldn’t load the map. Check your connection.',
    );
  });

  test('a map that never starts gets the "taking too long" notice', async () => {
    const r = await openHome();
    await act(async () => {
      jest.advanceTimersByTime(16_000);
    });
    const all = texts(r).join(' ');
    expect(all).toContain('taking too long');
    // The fallback does not use Google Play services.
    expect(all).not.toContain('Google Play');
  });

  test('does not claim it is slow once the page has started', async () => {
    const r = await openHome();
    await say(r, {type: 'ready'});
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(texts(r).join(' ')).not.toContain('taking too long');
  });

  describe('when the page cannot start', () => {
    test('a page error before it is ready shows the list instead', async () => {
      const r = await openHome();
      await say(r, {type: 'error', message: 'Leaflet did not load'});
      expect(texts(r)).toContain('Map isn’t available');
      const button = r.root.find(
        n =>
          n.props.accessibilityLabel === 'View chargers as a list' &&
          typeof n.props.onPress === 'function',
      );
      await act(async () => button.props.onPress());
      expect(probe.current).toBe('StationList');
    });

    test('an error after the map is up is ignored', async () => {
      const r = await openHome();
      await say(r, {type: 'ready'});
      await say(r, {type: 'error', message: 'something small'});
      expect(texts(r)).not.toContain('Map isn’t available');
    });

    test('a build without the native WebView shows the list instead', async () => {
      global.__WEBVIEW_MISSING = true;
      const r = await openHome();
      expect(hasPage(r)).toBe(false);
      expect(texts(r)).toContain('Map isn’t available');
      expect(texts(r).join(' ')).not.toContain('taking too long');
    });
  });
});

describe('Embedded maps without a Maps key', () => {
  const from = {latitude: 28.6, longitude: 77.2};
  const to = {latitude: 28.7, longitude: 77.3};
  const route = {
    fromLabel: 'Delhi',
    toLabel: 'Jaipur',
    polyline: [from, to],
    stops: [
      {
        station: {
          id: 'st1',
          name: 'Stop One',
          latitude: 28.65,
          longitude: 77.25,
        },
      },
    ],
  } as unknown as Route;

  async function render(ui: React.ReactElement) {
    let r!: Renderer;
    await act(async () => {
      r = ReactTestRenderer.create(ui);
    });
    mounted.push(r);
    return r;
  }

  test('the route preview fits the route and marks its start, end and stops', async () => {
    const r = await render(<RouteMap route={route} height={210} />);
    await say(r, {type: 'ready'});
    const state = lastState();
    expect(state.pins.map(p => p.kind).sort()).toEqual(
      ['end', 'start', 'stop'].sort(),
    );
    expect(state.route?.points).toHaveLength(2);
    expect(calls('window.PO.fit(')).toHaveLength(1);
    // A static preview: touches go to the screen's own scrolling.
    expect(
      r.root.find(n => n.props.testID === 'osm-map').props.pointerEvents,
    ).toBe('none');
  });

  test('the station mini map shows where you are and where the charger is', async () => {
    const r = await render(<StationMiniMap from={from} to={to} />);
    await say(r, {type: 'ready'});
    expect(
      lastState()
        .pins.map(p => p.kind)
        .sort(),
    ).toEqual(['me', 'pin']);
    expect(calls('window.PO.fit(')).toHaveLength(1);
  });

  test('each falls back to a short note if the map cannot start', async () => {
    const preview = await render(<RouteMap route={route} />);
    await say(preview, {type: 'error', message: 'x'});
    expect(texts(preview)).toContain('Map isn’t available');

    const mini = await render(<StationMiniMap from={from} to={to} />);
    await say(mini, {type: 'error', message: 'x'});
    expect(texts(mini)).toContain('Map isn’t available');
  });
});

describe('The fallback page', () => {
  const opts = {
    center: {latitude: 28.6139, longitude: 77.209},
    zoom: 13,
    interactive: true,
    zoomButtons: true,
  };

  test('is self-contained: Leaflet is inlined, only tiles come from the network', () => {
    const html = buildMapHtml(opts);
    expect(html).toContain(LEAFLET_JS.slice(0, 80));
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).toContain('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    const config = html.match(
      /<script type="application\/json" id="po-config">(.*?)<\/script>/s,
    )![1];
    expect(JSON.parse(config).attribution).toContain(
      'OpenStreetMap</a> contributors',
    );
  });

  test('lets the Referer through in full, which identifies the app to the tile server', () => {
    // The default policy would cut it to the bare origin.
    expect(buildMapHtml(opts)).toContain(
      '<meta name="referrer" content="no-referrer-when-downgrade">',
    );
  });

  test('the inlined Leaflet is the installed version (re-run scripts/gen-leaflet.js if not)', () => {
    expect(LEAFLET_VERSION).toBe(require('leaflet/package.json').version);
  });

  test('cannot be broken out of by its configuration', () => {
    const html = buildMapHtml({
      ...opts,
      center: {latitude: 1, longitude: 2},
    });
    const config = html.match(
      /<script type="application\/json" id="po-config">(.*?)<\/script>/s,
    )![1];
    expect(config).not.toContain('<');
    expect(JSON.parse(config).center).toEqual([1, 2]);
  });
});
