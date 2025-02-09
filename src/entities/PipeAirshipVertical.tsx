import React from 'react';
import clsx from 'clsx';
import type { Entity } from './types';
import { encodeObjectSets, getBankParam1 } from './util';
import { TILE_SIZE } from '../tiles/constants';
import { ANY_SPRITE_GRAPHIC_SET } from './constants';
import { Resizer } from '../components/Resizer';

import styles from '../components/Resizer/ResizingStyles.module.css';
import { TransportSource } from '../components/Transport/TransportSource';
import { TileSpace } from './TileSpace';
import { getBasePipeProperties } from './getBasePipeProperties';

const transportObjectId = 0x17;
const nonTransportObjectId = 0x18;

const PipeAirshipVertical: Entity = {
	...getBasePipeProperties('PipeAirshipVertical'),
	paletteCategory: 'transport',
	paletteInfo: {
		title: 'Airship Pipe - Vertical',
		description:
			'Like normal pipes but with a smaller lip and only available in one direction.',
	},

	objectSets: encodeObjectSets([[0xa, 10]]),
	spriteGraphicSets: ANY_SPRITE_GRAPHIC_SET,
	layer: 'stage',
	editorType: 'entity',
	settingsType: 'single',
	defaultSettings: { width: 2, height: 2 },
	dimensions: 'none',
	param1: 'height',
	objectId: transportObjectId,
	alternateObjectIds: [nonTransportObjectId],
	emptyBank: 1,

	toObjectBinary(x, y, _w, _h, settings) {
		const height = settings.height ?? 1;

		const objectId = settings.destination
			? transportObjectId
			: nonTransportObjectId;

		return [getBankParam1(1, height - 1), y, x, objectId];
	},

	simpleRender(size) {
		const style = { width: size, height: size };
		const lipStyle = { width: size, height: size / 2 };
		const bodyStyle = { width: size, height: size / 2, backgroundSize: '100%' };

		return (
			<div className="flex flex-col" style={style}>
				<div className="PipeAirshipVerticalLip-bg bg-cover" style={lipStyle} />
				<div
					className="PipeAirshipVerticalBody-bg bg-repeat-y"
					style={bodyStyle}
				/>
			</div>
		);
	},

	render(_showDetails, settings, onSettingsChange, entity) {
		const height = (settings.height ?? this.defaultSettings!.height) as number;
		const destination = settings.destination;

		const style = {
			width: 2 * TILE_SIZE,
			height: height * TILE_SIZE,
		};

		const lipStyle = {
			width: 2 * TILE_SIZE,
			height: TILE_SIZE,
		};

		const bodyHeight = height - 1;
		const bodyStyle = {
			width: 2 * TILE_SIZE,
			height: bodyHeight * TILE_SIZE,
			backgroundSize: '100%',
		};

		const size = { x: 1, y: height };

		const upperLip = (
			<div
				className="PipeAirshipVerticalLip-bg flex flex-row items-center justify-around"
				style={lipStyle}
			>
				{!!entity && (
					<>
						<TransportSource
							destRoom={destination?.room}
							destX={destination?.x}
							destY={destination?.y}
							exitCategory="pipe"
							onDestinationSet={(newDestination) => {
								onSettingsChange({ destination: newDestination });
							}}
						/>
					</>
				)}
			</div>
		);

		const body = (
			<div
				className="PipeAirshipVerticalBody-bg bg-repeat-y"
				style={bodyStyle}
			/>
		);

		return (
			<div
				style={style}
				className={clsx('relative flex flex-col', {
					[styles.resizing]: settings?.resizing,
				})}
			>
				{!!entity && <TileSpace className="absolute w-full h-full" />}
				{upperLip}
				{body}
				{entity && (
					<Resizer
						className="absolute bottom-0 right-0"
						style={{ marginRight: '-0.12rem', marginBottom: '-0.12rem' }}
						size={size}
						increment={TILE_SIZE}
						axis="y"
						onSizeChange={(newSizePoint) => {
							onSettingsChange({ height: Math.max(1, newSizePoint.y) });
						}}
						onResizeStart={() => onSettingsChange({ resizing: true })}
						onResizeEnd={() => onSettingsChange({ resizing: false })}
					/>
				)}
			</div>
		);
	},
};

export { PipeAirshipVertical };
