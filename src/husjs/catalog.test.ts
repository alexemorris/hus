import { describe, expect, it } from 'vitest';
import * as architectural from 'husjs/catalog/architectural';
import * as appliances from 'husjs/catalog/appliances';
import * as furniture from 'husjs/catalog/furniture';
import * as lighting from 'husjs/catalog/lighting';
import * as sanitaryware from 'husjs/catalog/sanitaryware';
import * as materials from 'husjs/materials';
import * as objects from 'husjs/objects';

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

    // Heritage aged timber & lime-plaster public exports
    expect(typeof architectural.AGED_TIMBER_PROFILES).toBe('object');
    expect(typeof architectural.createAgedTimberBeamGeometry).toBe('function');
    expect(typeof architectural.createAgedTimberBoxBeamGeometry).toBe('function');
    expect(typeof architectural.createPlasterBeamHaunchGeometry).toBe('function');
    expect(typeof architectural.createAgedTimberBeam).toBe('function');
    expect(typeof architectural.createAgedJoistBay).toBe('function');
    expect(typeof architectural.createAgedRoofTruss).toBe('function');

    expect(objects.AGED_TIMBER_PROFILES).toBe(architectural.AGED_TIMBER_PROFILES);
    expect(objects.createAgedTimberBeam).toBe(architectural.createAgedTimberBeam);
    expect(objects.createAgedJoistBay).toBe(architectural.createAgedJoistBay);
    expect(objects.createAgedRoofTruss).toBe(architectural.createAgedRoofTruss);
    expect(typeof objects.createHeritagePlasterWallGeometry).toBe('function');
    expect(typeof objects.createHeritageSkeilingSlabGeometry).toBe('function');
    expect(typeof objects.createSoftenedPlasterRevealLinings).toBe('function');
    expect(typeof materials.getHeritageLimePlasterNormalMap).toBe('function');
  });
});
