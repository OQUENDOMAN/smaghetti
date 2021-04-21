import React, { FunctionComponent } from 'react';
import clsx from 'clsx';
import { Tile } from '../../../Tile';
import { Entity } from '../../../Entity';
import { TILE_SIZE } from '../../../../tiles/constants';

import styles from './PaletteEntry.module.css';
import { entityMap, EntityType } from '../../../../entities/entityMap';
import { TransportSource } from '../../../Transport/TransportSource';

const SCALE = 50 / TILE_SIZE;

type PaletteEntryProps = {
	className?: string;
	entry: EntityType;
	isCurrent: boolean;
	buttonsOnHover?: boolean;
	showAdd: boolean;
	showRemove: boolean;
	onClick: () => void;
	onAddClick?: () => void;
	onRemoveClick?: () => void;
	incompatible?: boolean;
};

const PaletteEntry: FunctionComponent<PaletteEntryProps> = ({
	className,
	entry,
	isCurrent,
	onClick,
	showAdd,
	showRemove,
	buttonsOnHover,
	onAddClick,
	onRemoveClick,
	incompatible,
}) => {
	let item;

	switch (entityMap[entry].editorType) {
		case 'tile':
			item = <Tile tileType={entry} scale={SCALE} />;
			break;
		case 'entity':
			item = <Entity scale={6.25} maxWidth={50} maxHeight={50} type={entry} />;
			break;
		case 'transport':
			item = (
				<div style={{ transform: `scale(${SCALE * 1.3})` }}>
					<TransportSource
						label="warp"
						destRoom={-1}
						destX={-1}
						destY={-1}
						exitType={0}
					/>
				</div>
			);
			break;
	}

	return (
		<div
			className={clsx(className, styles.root, {
				[styles.isCurrent]: isCurrent,
				[styles.buttonsOnHover]: buttonsOnHover,
			})}
			onClick={onClick}
		>
			<div
				className={clsx('w-full h-full grid place-items-center', {
					'opacity-20 hover:opacity-100': incompatible,
				})}
			>
				{item}
			</div>

			{showAdd && !incompatible && (
				<button
					className={clsx(styles.button, 'bg-green-600 text-white')}
					onClick={onAddClick}
				>
					add
				</button>
			)}
			{showRemove && !incompatible && (
				<button
					className={clsx(styles.button, 'bg-red-600 text-white')}
					onClick={onRemoveClick}
				>
					remove
				</button>
			)}
			{incompatible && (
				<div
					className={clsx(styles.button, 'bg-red-600 text-white text-center')}
				>
					<div>can&apos;t add</div>
				</div>
			)}
		</div>
	);
};

export { PaletteEntry };
export type { PaletteEntryProps };
