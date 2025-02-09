import React from 'react';
import type { Entity } from '../types';
import { encodeObjectSets, getBankParam1 } from '../util';
import { TILE_SIZE } from '../../tiles/constants';
import { PayloadViewDetails } from '../detailPanes/PayloadViewDetails';
import { EntityType } from '../entityMap';
import { ResourceType } from '../../resources/resourceMap';
import { PayloadEditDetails } from '../detailPanes/PayloadEditDetails';
import { ANY_SPRITE_GRAPHIC_SET } from '../constants';
import { objectSets } from './objectSets';

const BuriedVegetable: Entity = {
	paletteCategory: 'terrain',
	paletteInfo: {
		title: 'Buried Vegetable',
		description: 'Can pull up all kinds of things...',
	},

	objectSets: encodeObjectSets(objectSets),
	spriteGraphicSets: ANY_SPRITE_GRAPHIC_SET,
	layer: 'stage',
	editorType: 'cell',
	settingsType: 'single',
	defaultSettings: { payload: 'SmallVegetable' },
	dimensions: 'none',
	// empty veggie, nothing comes up
	objectId: 0x66,
	payloadBank: 1,
	emptyBank: 1,
	payloadToObjectId: {
		Coin: 0x63,
		CoinCache: 0x64,
		GiantVegetable: 0x5a,
		KoopaShell: 0x7e,
		// does not work with underground graphic set
		// MontyMole: 0x69,
		OneUpMushroom: 0x65,
		PoisonMushroom: 0x67,
		RegularVegetable: 0x5b,
		SmallVegetable: 0x5c,
	},

	resource: {
		palettes: [
			[
				0x7f40,
				0x7fff,
				0x0,
				0x7629,
				0x7f30,
				0x7fd2,
				0x7ffb,
				0x2e39,
				0x42bd,
				0x535f,
				0x3708,
				0x3f6d,
				0x4bd1,
				0x5bf4,
				0x36df,
				0x6bf8,
			],
		],
		romOffset: 0x20e4f0,
		tiles: [
			[74, 75],
			[46, 47],
		],
	},

	toObjectBinary(x, y, _w, _h, settings) {
		const payloadToObjectId = this.payloadToObjectId!;

		const objectId =
			payloadToObjectId[settings.payload as keyof typeof payloadToObjectId]! ??
			this.objectId;

		return [getBankParam1(1, 0), y, x, objectId];
	},

	simpleRender(size) {
		return (
			<div
				className="BuriedVegetable-bg bg-cover"
				style={{ width: size, height: size }}
			/>
		);
	},

	render(showDetails, settings, onSettingsChange) {
		const body = (
			<div
				className="BuriedVegetable-bg bg-cover relative cursor-pointer"
				style={{ width: TILE_SIZE, height: TILE_SIZE }}
			>
				<PayloadViewDetails payload={settings.payload} />
			</div>
		);

		if (showDetails) {
			const payloads = Object.keys(this.payloadToObjectId!) as Array<
				EntityType | ResourceType
			>;

			return (
				<PayloadEditDetails
					width={TILE_SIZE}
					height={TILE_SIZE}
					onPayloadChange={(payload) => onSettingsChange({ payload })}
					payloads={payloads}
					canClear
				>
					{body}
				</PayloadEditDetails>
			);
		} else {
			return body;
		}
	},
};

export { BuriedVegetable };
