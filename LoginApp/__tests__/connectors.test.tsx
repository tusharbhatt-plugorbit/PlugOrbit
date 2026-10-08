/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';
import type {ConnectorType} from '../src/domain/types';
import {TestApp, seedSignedIn} from '../src/dev/testHarness';
import {appStore} from '../src/store/appStore';
import {CONNECTOR_INFO, ConnectorSelectionCard, ConnectorTag} from '../src/ui';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

const ALL: ConnectorType[] = ['CCS2', 'Type2', 'CHAdeMO', 'GBT', 'LECCS'];

const mounted: Renderer[] = [];
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

async function render(node: React.ReactElement): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(node);
  });
  mounted.push(r);
  return r;
}

const texts = (r: Renderer) =>
  r.root
    .findAllByType(Text)
    .map(n => ([] as unknown[]).concat(n.props.children).join(''));

describe('ConnectorSelectionCard', () => {
  test.each(ALL)('%s has a name, an AC/DC line and a picture', async type => {
    const r = await render(
      <ConnectorSelectionCard
        type={type}
        selected={false}
        onPress={() => {}}
      />,
    );
    expect(texts(r)).toEqual([
      CONNECTOR_INFO[type].name,
      CONNECTOR_INFO[type].kind,
    ]);
    // The picture is an SVG face of the plug, not an empty box.
    expect(
      r.root.findAll(n => n.props.viewBox === '0 0 64 64').length,
    ).toBeGreaterThan(0);
  });

  test('names the plug and says whether it is AC or DC', () => {
    expect(CONNECTOR_INFO.CCS2).toEqual({
      name: 'CCS2',
      kind: 'DC fast charging',
    });
    expect(CONNECTOR_INFO.Type2).toEqual({name: 'Type 2', kind: 'AC charging'});
  });

  test('selected reads as checked and toggles on press', async () => {
    const onPress = jest.fn();
    const r = await render(
      <ConnectorSelectionCard type="CCS2" selected onPress={onPress} />,
    );
    const card = r.root.findByProps({accessibilityRole: 'checkbox'});
    expect(card.props.accessibilityState).toEqual({checked: true});
    expect(card.props.accessibilityLabel).toBe('CCS2, DC fast charging');
    await act(async () => card.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('unselected is clearly unchecked', async () => {
    const r = await render(
      <ConnectorSelectionCard
        type="Type2"
        selected={false}
        onPress={() => {}}
      />,
    );
    expect(
      r.root.findByProps({accessibilityRole: 'checkbox'}).props
        .accessibilityState,
    ).toEqual({checked: false});
  });

  test('without onPress it is a read-only summary, not a button', async () => {
    const r = await render(<ConnectorSelectionCard type="CCS2" selected />);
    expect(
      r.root.findAll(n => n.props.accessibilityRole === 'checkbox'),
    ).toHaveLength(0);
    expect(
      r.root.findAll(n => typeof n.props.onPress === 'function'),
    ).toHaveLength(0);
  });

  test('ConnectorTag shows the short name', async () => {
    const r = await render(<ConnectorTag type="Type2" />);
    expect(texts(r)).toEqual(['Type 2']);
  });
});

describe('Vehicle Setup connector choice', () => {
  async function openSetup(): Promise<Renderer> {
    seedSignedIn();
    appStore.set({vehicles: [], activeVehicleId: null});
    let r!: Renderer;
    await act(async () => {
      r = ReactTestRenderer.create(
        <TestApp
          stack={[{name: 'VehicleSetup', params: {onboarding: true}}]}
        />,
      );
    });
    mounted.push(r);
    for (let i = 0; i < 4; i++) {
      await act(async () => {});
    }
    return r;
  }

  const press = async (r: Renderer, label: string) => {
    const node = r.root.find(
      n =>
        n.props.accessibilityLabel === label &&
        typeof n.props.onPress === 'function',
    );
    await act(async () => node.props.onPress());
  };
  const card = (r: Renderer, label: string) =>
    r.root.find(
      n =>
        n.props.accessibilityLabel === label &&
        n.props.accessibilityRole === 'checkbox',
    );

  test('"My car isn\'t listed" shows one picture card per supported plug', async () => {
    const r = await openSetup();
    await press(r, 'My car isn’t listed');
    for (const label of [
      'CCS2, DC fast charging',
      'Type 2, AC charging',
      'CHAdeMO, DC fast charging',
      'GB/T, DC fast charging',
    ]) {
      expect(card(r, label).props.accessibilityState).toEqual({checked: false});
    }
    expect(texts(r)).toContain('Which plug does your car use?');
  });

  test('choosing plugs highlights them and lists them above Save', async () => {
    const r = await openSetup();
    await press(r, 'My car isn’t listed');
    expect(texts(r)).toContain('Pick the plugs your car can use.');

    await press(r, 'CCS2, DC fast charging');
    await press(r, 'Type 2, AC charging');
    expect(card(r, 'CCS2, DC fast charging').props.accessibilityState).toEqual({
      checked: true,
    });
    expect(card(r, 'Type 2, AC charging').props.accessibilityState).toEqual({
      checked: true,
    });
    expect(
      card(r, 'CHAdeMO, DC fast charging').props.accessibilityState,
    ).toEqual({checked: false});
    expect(texts(r)).toContain('Chargers with');

    await press(r, 'CCS2, DC fast charging');
    expect(card(r, 'CCS2, DC fast charging').props.accessibilityState).toEqual({
      checked: false,
    });
  });

  test('saving without a plug explains what to do', async () => {
    const r = await openSetup();
    await press(r, 'My car isn’t listed');
    await press(r, 'Save vehicle');
    expect(texts(r)).toContain('Pick at least one connector your car can use.');
  });

  test('picking a catalogue car shows its plugs with pictures', async () => {
    const r = await openSetup();
    await act(async () => {
      r.root
        .find(
          n =>
            typeof n.props.accessibilityLabel === 'string' &&
            n.props.accessibilityLabel.startsWith('Tata Nexon EV') &&
            typeof n.props.onPress === 'function',
        )
        .props.onPress();
    });
    expect(texts(r)).toContain('Chargers with');
    expect(texts(r).filter(t => t === 'CCS2').length).toBeGreaterThan(0);
  });
});
