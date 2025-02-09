import React from 'react';
import type { Entity } from './types';
import { encodeObjectSets, getBankParam1 } from './util';
import { TILE_SIZE } from '../tiles/constants';
import { ANY_SPRITE_GRAPHIC_SET } from './constants';

function isPlatformToLeft(
	entity: EditorEntity | undefined,
	room: RoomData | undefined
): boolean {
	if (!entity || !room) {
		return false;
	}

	const cellToLeft = room.stage.matrix[entity.y]?.[entity.x - 1];

	if (!cellToLeft) {
		return false;
	}

	return cellToLeft.type === 'CloudPlatformThin';
}

function isPlatformToRight(
	entity: EditorEntity | undefined,
	room: RoomData | undefined
): boolean {
	if (!entity || !room) {
		return false;
	}

	const cellToRight = room.stage.matrix[entity.y]?.[entity.x + 1];

	if (!cellToRight) {
		return false;
	}

	return cellToRight.type === 'CloudPlatformThin';
}

const CloudPlatformThin: Entity = {
	paletteCategory: 'terrain',
	paletteInfo: {
		subCategory: 'terrain-sky',
		title: 'Cloud Platform - Thin',
	},

	objectSets: encodeObjectSets([
		[11, 13],
		[13, 13],
		[5, 13],
	]),
	spriteGraphicSets: ANY_SPRITE_GRAPHIC_SET,
	layer: 'stage',
	editorType: 'cell',
	dimensions: 'x',
	param1: 'width',
	objectId: 0xc,
	emptyBank: 1,

	resource: {
		palettes: [
			[
				31744,
				32767,
				0,
				26019,
				31371,
				32622,
				32726,
				5524,
				11833,
				17085,
				8800,
				10952,
				15180,
				18352,
				8767,
				22515,
			],
		],
		tiles: [
			[268, 269, 270, 269, 270, 271],
			[284, 285, 286, 285, 286, 287],
		],
		romOffset: 1253344,
	},

	toObjectBinary(x, y, w) {
		return [getBankParam1(1, w), y, x, this.objectId];
	},

	simpleRender(size) {
		return (
			<div
				className="CloudPlatformThin-bg bg-center bg-no-repeat"
				style={{ width: size, height: size, backgroundSize: '100% 33%' }}
			/>
		);
	},

	render(_showDetails, _settings, _onSettingsChange, entity, room) {
		const platformToLeft = isPlatformToLeft(entity, room);
		const platformToRight = isPlatformToRight(entity, room);

		let bgOffset = 0;

		switch (`${platformToLeft}-${platformToRight}`) {
			case 'true-true':
				bgOffset = 1;
				break;
			case 'false-true':
			case 'false-false':
				bgOffset = 0;
				break;
			case 'true-false':
				bgOffset = 2;
				break;
		}

		const style = {
			width: TILE_SIZE,
			height: TILE_SIZE,
			backgroundPositionX: -bgOffset * TILE_SIZE,
		};

		return <div style={style} className="CloudPlatformThin-bg" />;
	},

	getWarning(_settings, entity, room) {
		const platformToLeft = isPlatformToLeft(entity, room);
		const platformToRight = isPlatformToRight(entity, room);

		if (!platformToRight && !platformToLeft) {
			return 'Needs to be at least 2 tiles wide';
		}
	},
};

export { CloudPlatformThin };
