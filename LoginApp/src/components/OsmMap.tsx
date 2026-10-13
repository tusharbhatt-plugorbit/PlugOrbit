import React, {
  Component,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import type {StyleProp, ViewStyle} from 'react-native';
import type {
  WebView as WebViewType,
  WebViewMessageEvent,
  WebViewProps,
} from 'react-native-webview';
import {TILE_REFERER} from '../config/mapTiles';
import {
  buildMapHtml,
  type MapMessage,
  type MapPin,
  type MapRoute,
} from '../maps/osmMapHtml';
import {colors, elevation, radii, spacing, type} from '../theme';
import type {Coords} from '../utils/geo';

export type OsmMapHandle = {
  animateTo: (center: Coords, zoomedIn?: boolean) => void;
};

type Props = {
  initialCenter: Coords;
  /** Leaflet zoom level to start at (13 is about 9 km across a phone). */
  initialZoom?: number;
  pins: readonly MapPin[];
  route?: MapRoute | null;
  /** Fit the view to these points whenever they change. */
  fit?: readonly Coords[];
  /** Highest zoom `fit` may choose. */
  fitMaxZoom?: number;
  /** Pan and zoom by touch (default). Off for small previews. */
  interactive?: boolean;
  zoomButtons?: boolean;
  style?: StyleProp<ViewStyle>;
  onPinPress?: (id: string) => void;
  onPress?: () => void;
  /** The person moved the map; not called for our own animations. */
  onCenterChange?: (center: Coords) => void;
  onReady?: () => void;
  /**
   * The map cannot be drawn at all (its native component is missing from this
   * build, or the page failed to start). The caller shows its own explanation.
   */
  onUnavailable?: () => void;
};

export const CLOSE_ZOOM = 15;
export const WIDE_ZOOM = 13;

type WebViewComponent = React.ComponentType<
  WebViewProps & React.RefAttributes<WebViewType>
>;

// Loaded lazily so a build that does not have the native module yet (after
// pulling this change, before `npm install` and a rebuild) shows a message
// instead of failing to start. Metro treats a require inside try/catch as optional.
function loadWebView(): WebViewComponent | null {
  try {
    return require('react-native-webview').WebView as WebViewComponent;
  } catch {
    return null;
  }
}

/** Turns a render-time failure (e.g. the native view is not registered) into a callback. */
class Boundary extends Component<
  {onError: () => void; children: React.ReactNode},
  {failed: boolean}
> {
  state = {failed: false};
  static getDerivedStateFromError() {
    return {failed: true};
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const jsCall = (call: string) => `try{${call}}catch(e){};true;`;

const OsmMap = forwardRef<OsmMapHandle, Props>(function OsmMapInner(
  {
    initialCenter,
    initialZoom = WIDE_ZOOM,
    pins,
    route = null,
    fit,
    fitMaxZoom = CLOSE_ZOOM,
    interactive = true,
    zoomButtons = interactive,
    style,
    onPinPress,
    onPress,
    onCenterChange,
    onReady,
    onUnavailable,
  },
  ref,
) {
  const [WebView] = useState(loadWebView);
  const webRef = useRef<WebViewType>(null);
  // Fixed for the life of the page: changing it would reload the whole map.
  const [html] = useState(() =>
    buildMapHtml({
      center: initialCenter,
      zoom: initialZoom,
      interactive,
      zoomButtons,
    }),
  );
  const [attempt, setAttempt] = useState(0);
  const [tilesFailed, setTilesFailed] = useState(false);

  const ready = useRef(false);
  // What the page last drew, so unchanged state is not sent again.
  const sentState = useRef('');
  const sentFit = useRef('');
  const pendingView = useRef<string | null>(null);

  const inject = useCallback((call: string) => {
    webRef.current?.injectJavaScript(jsCall(call));
  }, []);

  const push = useCallback(() => {
    if (!ready.current) {
      return;
    }
    const state = JSON.stringify({pins, route});
    if (state !== sentState.current) {
      sentState.current = state;
      inject(`window.PO.set(${state})`);
    }
    if (fit && fit.length > 0) {
      const points = JSON.stringify(fit.map(p => [p.latitude, p.longitude]));
      const key = `${points}|${fitMaxZoom}`;
      if (key !== sentFit.current) {
        sentFit.current = key;
        inject(`window.PO.fit(${points},${fitMaxZoom})`);
      }
    }
    if (pendingView.current) {
      inject(pendingView.current);
      pendingView.current = null;
    }
  }, [pins, route, fit, fitMaxZoom, inject]);

  useEffect(push, [push]);

  useImperativeHandle(
    ref,
    () => ({
      animateTo: (center, zoomedIn = false) => {
        const call = `window.PO.view(${center.latitude},${center.longitude},${
          zoomedIn ? CLOSE_ZOOM : WIDE_ZOOM
        })`;
        if (ready.current) {
          inject(call);
        } else {
          pendingView.current = call;
        }
      },
    }),
    [inject],
  );

  const reload = useCallback(() => {
    ready.current = false;
    sentState.current = '';
    sentFit.current = '';
    setTilesFailed(false);
    setAttempt(n => n + 1);
  }, []);

  const unavailable = useCallback(() => onUnavailable?.(), [onUnavailable]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: MapMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data) as MapMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'ready':
          ready.current = true;
          push();
          onReady?.();
          break;
        case 'marker':
          onPinPress?.(msg.id);
          break;
        case 'press':
          onPress?.();
          break;
        case 'move':
          onCenterChange?.({latitude: msg.lat, longitude: msg.lng});
          break;
        case 'tiles':
          setTilesFailed(!msg.ok);
          break;
        case 'error':
          // Only fatal while starting; the page reports nothing after that.
          if (!ready.current) {
            unavailable();
          }
          break;
      }
    },
    [push, onReady, onPinPress, onPress, onCenterChange, unavailable],
  );

  // Without the native module there is nothing to draw with.
  useEffect(() => {
    if (!WebView) {
      unavailable();
    }
  }, [WebView, unavailable]);

  if (!WebView) {
    return null;
  }

  return (
    <View
      style={[styles.wrap, style]}
      testID="osm-map"
      pointerEvents={interactive ? 'auto' : 'none'}>
      <Boundary onError={unavailable}>
        <WebView
          key={attempt}
          ref={webRef}
          testID="osm-webview"
          style={styles.web}
          originWhitelist={['*']}
          source={{html, baseUrl: TILE_REFERER}}
          javaScriptEnabled
          domStorageEnabled
          scrollEnabled={false}
          overScrollMode="never"
          bounces={false}
          nestedScrollEnabled
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          mixedContentMode="never"
          onMessage={onMessage}
          onRenderProcessGone={reload}
          onContentProcessDidTerminate={reload}
          onShouldStartLoadWithRequest={request => {
            const url = request.url;
            if (
              url === 'about:blank' ||
              url.startsWith('data:') ||
              url === TILE_REFERER
            ) {
              return true;
            }
            // Attribution links open in the browser, not inside the map.
            if (/^https?:/i.test(url)) {
              Linking.openURL(url).catch(() => undefined);
            }
            return false;
          }}
        />
      </Boundary>
      {tilesFailed && interactive && (
        <View
          style={[styles.notice, elevation(1)]}
          accessibilityRole="alert"
          testID="osm-tiles-failed">
          <Text style={styles.noticeText}>
            Couldn’t load the map. Check your connection.
          </Text>
          <Pressable
            onPress={reload}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="Reload map">
            <Text style={styles.noticeAction}>Reload</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {backgroundColor: colors.mapBg, overflow: 'hidden'},
  web: {flex: 1, backgroundColor: colors.mapBg},
  notice: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radii.md,
  },
  noticeText: {...type.caption, color: colors.inkSoft, fontWeight: '600'},
  noticeAction: {color: colors.limeDark, fontSize: 13, fontWeight: '800'},
});

export default OsmMap;
