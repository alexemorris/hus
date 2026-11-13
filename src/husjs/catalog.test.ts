import { describe, expect, it } from 'vitest';
import * as architectural from 'husjs/catalog/architectural';
import * as appliances from 'husjs/catalog/appliances';
import * as furniture from 'husjs/catalog/furniture';
import * as lighting from 'husjs/catalog/lighting';
import * as sanitaryware from 'husjs/catalog/sanitaryware';

describe('husjs/catalog/* public barrel entrypoints', () => {
  it('re-exports architectural, appliances, furniture, lighting & sanitaryware builders', () => {
    expect(typeof architectural.buildNeptuneInFrameCabinetRun).toBe('function');
    expect(typeof architectural.buildNeptuneLarderPantry).toBe('function');
    expect(typeof architectural.buildNeptuneMantleCanopyHood).toBe('function');
    expect(typeof architectural.buildShawsBelfastSinkAndBridgeTap).toBe('function');
    expect(typeof architectural.buildNeptuneKitchenIsland).toBe('function');
    expect(typeof architectural.buildGeorgianTuscanPorticoAndDoor).toBe('function');
    expect(typeof architectural.buildGeorgianBrickRailingsAndGate).toBe('function');
    expect(typeof architectural.buildGeorgianFacadeDressings).toBe('function');
    expect(typeof architectural.buildGeorgianBolectionFireplace).toBe('function');
    expect(typeof architectural.buildGeorgianAlcoveBookcase).toBe('function');
    expect(typeof architectural.buildTongueAndGrooveDadoPanelling).toBe('function');
    expect(typeof architectural.buildNeptuneBootBenchAndPegRail).toBe('function');
    expect(typeof architectural.createCarraraNeroChequerboardTextures).toBe('function');
    expect(typeof architectural.buildChequerboardMarbleFloor).toBe('function');

    expect(typeof appliances.buildLacancheCluny1000Range).toBe('function');

    expect(typeof furniture.buildNeptuneUpholsteredSofa).toBe('function');
    expect(typeof furniture.buildNeptuneArmchair).toBe('function');
    expect(typeof furniture.buildNeptuneArundelDiningSet).toBe('function');
    expect(typeof furniture.buildNeptuneChichesterGlazedDresser).toBe('function');
    expect(typeof furniture.buildNeptuneCounterStool).toBe('function');
    expect(typeof furniture.buildNeptuneOakTablesAndBedsides).toBe('function');
    expect(typeof furniture.buildWhiteCompanyBedStyling).toBe('function');
    expect(typeof furniture.buildGeorgianAntiqueCasework).toBe('function');
    expect(typeof furniture.buildGeorgianFiresideSet).toBe('function');
    expect(typeof furniture.buildCuratedMirrorsArtAndRugs).toBe('function');
    expect(typeof furniture.buildWhiteCompanyAccessories).toBe('function');

    expect(typeof lighting.buildGeorgianCoachLantern).toBe('function');
    expect(typeof lighting.buildHeritageInteriorLighting).toBe('function');

    expect(typeof sanitaryware.buildNeptuneChichesterVanity).toBe('function');
    expect(typeof sanitaryware.buildCrittallWalkInShowerAndTowelRail).toBe('function');
  });
});
