import React from 'react';
import type { Entity } from './types';
import { encodeObjectSets, getBankParam1 } from './util';
import { ANY_SPRITE_GRAPHIC_SET } from './constants';
import { ResizableRect } from '../components/ResizableRect';
import { TILE_SIZE } from '../tiles/constants';

const RECT_CLASSES = [
	[
		'ColorfulMetalBoxUpperLeft-bg',
		'ColorfulMetalBoxTop-bg',
		'ColorfulMetalBoxUpperRight-bg',
	],
	[
		'ColorfulMetalBoxLeft-bg',
		'ColorfulMetalBox-bg',
		'ColorfulMetalBoxRight-bg',
	],
	[
		'ColorfulMetalBoxLowerLeft-bg',
		'ColorfulMetalBoxBottom-bg',
		'ColorfulMetalBoxLowerRight-bg',
	],
];

const colorToObjectId = {
	white: 0x4,
	orange: 0x5,
	green: 0x6,
	blue: 0x7,
};

type Color = keyof typeof colorToObjectId;

const buttonColorToCss: Record<Color, string> = {
	white: 'white',
	orange: '#f8a060',
	green: '#90c868',
	blue: '#70d8f8',
};

const overlayColorToCss: Record<Color, string> = {
	white: 'transparent',
	orange: '#f8a060',
	green: '#90c868',
	blue: '#70d8f8',
};

const colorCycle: Color[] = Object.keys(colorToObjectId) as Color[];

const ColorfulMetalBox: Entity = {
	paletteCategory: 'terrain',
	paletteInfo: {
		subCategory: 'terrain-large',
		title: 'Colorful Metal Box',
	},

	objectSets: encodeObjectSets([[1, 1]]),
	spriteGraphicSets: ANY_SPRITE_GRAPHIC_SET,
	layer: 'stage',
	editorType: 'entity',
	dimensions: 'none',
	param1: 'width',
	param2: 'height',
	objectId: 0x4,
	alternateObjectIds: Object.values(colorToObjectId),
	emptyBank: 1,
	settingsType: 'single',
	defaultSettings: { width: 2, height: 2, color: 'white' },

	resource: {
		palettes: [
			[
				0x7f96,
				0x7fff,
				0x0,
				0x39ce,
				0x4a52,
				0x6318,
				0x77bd,
				0x732c,
				0x7fd2,
				0x7ffb,
				0x5810,
				0x7597,
				0x7e1d,
			],
		],
		romOffset: 0x182cb4,
		tiles: [
			[246, 246],
			[246, 246],
		],
	},

	toObjectBinary(x, y, _w, _h, settings): number[] {
		const height = (settings.height ?? this.defaultSettings!.height) as number;
		const width = (settings.width ?? this.defaultSettings!.width) as number;
		const color = (settings.color ?? this.defaultSettings!.color) as Color;

		const objectId = colorToObjectId[color] ?? colorToObjectId.white;

		return [getBankParam1(1, width), y, x, objectId, height];
	},

	simpleRender(size) {
		const style = { width: size, height: size };

		const cornerStyle = { width: size / 2, height: size / 2 };

		return (
			<div style={style} className="grid grid-cols-2 grid-rows-2">
				<div
					style={cornerStyle}
					className="ColorfulMetalBoxUpperLeft-bg bg-cover"
				/>
				<div
					style={cornerStyle}
					className="ColorfulMetalBoxUpperRight-bg bg-cover"
				/>
				<div
					style={cornerStyle}
					className="ColorfulMetalBoxLowerLeft-bg bg-cover"
				/>
				<div
					style={cornerStyle}
					className="ColorfulMetalBoxLowerRight-bg bg-cover"
				/>
			</div>
		);
	},

	render(_showDetails, settings, onSettingsChange, entity) {
		const height = (settings.height ?? this.defaultSettings!.height) as number;
		const width = (settings.width ?? this.defaultSettings!.width) as number;
		const color = (settings.color ?? this.defaultSettings!.color) as Color;

		return (
			<ResizableRect
				className="relative"
				width={width}
				height={height}
				classes={RECT_CLASSES}
				hideResizer={!entity}
				minW={2}
				minH={2}
				onSizeChange={(width, height) => onSettingsChange({ width, height })}
			>
				<div
					className="absolute top-0 left-0 w-full h-full"
					style={{
						backgroundColor: overlayColorToCss[color],
						mixBlendMode: 'multiply',
					}}
				/>
				{!!entity && (
					<button
						className="absolute z-10"
						style={{
							top: `calc(50% - ${TILE_SIZE / 4}px)`,
							left: `calc(50% - ${TILE_SIZE / 4}px)`,
							width: TILE_SIZE / 2,
							height: TILE_SIZE / 2,
							border:
								color === 'white'
									? '1px solid rgb(0, 0, 0, 0.25)'
									: '1px solid white',
						}}
						onMouseDown={(e) => {
							e.preventDefault();
							e.stopPropagation();
							const i = colorCycle.indexOf(color);
							const ni = (i + 1) % colorCycle.length;
							onSettingsChange({ color: colorCycle[ni] });
						}}
					>
						<div
							className="w-full h-full"
							style={{ backgroundColor: buttonColorToCss[color] }}
						/>
					</button>
				)}
			</ResizableRect>
		);
	},
};

export { ColorfulMetalBox };
