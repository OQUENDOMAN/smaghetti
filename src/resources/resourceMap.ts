import { BigBooArm } from './BigBooArm';
import { BigBooBody } from './BigBooBody';
import { BigBooFace } from './BigBooFace';
import { BigBooTail } from './BigBooTail';
import { BoltNut } from './BoltNut';
import { BoltShaft } from './BoltShaft';
import { BowserFireStatueBody } from './BowserFireStatueBody';
import { BowserFireStatueHead } from './BowserFireStatueHead';
import { ChargingChuckBody } from './ChargingChuckBody';
import { ChargingChuckHead } from './ChargingChuckHead';
import { ClimbingVineHead } from './ClimbingVineHead';
import { CoinCache } from './CoinCache';
import { CoinSnake } from './CoinSnake';
import { DoorLock } from './DoorLock';
import { FlagPoleBall } from './FlagPoleBall';
import { FlagPoleShaft } from './FlagPoleShaft';
import { FlutterBody } from './FlutterBody';
import { FlutterFlower } from './FlutterFlower';
import { FlutterHead } from './FlutterHead';
import { FlutterWing } from './FlutterWing';
import { FortressBackground } from './FortressBackground';
import { FrogSuit } from './FrogSuit';
import { GiantVegetable } from './GiantVegetable';
import { GreenCheepCheep } from './GreenCheepCheep';
import { GreenSpinyEgg } from './GreenSpinyEgg';
import { GrassHorizontalDirt } from './GrassHorizontalDirt';
import { HoppingBowserStatueBody } from './HoppingBowserStatueBody';
import { HoppingBowserStatueHead } from './HoppingBowserStatueHead';
import { HorizontalDolphin } from './HorizontalDolphin';
import { HotHeadEyes } from './HotHeadEyes';
import { KoopalingWand } from './KoopalingWand';
import { KoopaShell } from './KoopaShell';
import { OneNumberBlock } from './OneNumberBlock';
import { OneWayDoorHorizontalFlipper } from './OneWayDoorHorizontalFlipper';
import { OneWayDoorVerticalFlipper } from './OneWayDoorVerticalFlipper';
import { OrangeSpinyEgg } from './OrangeSpinyEgg';
import { ParaWing } from './ParaWing';
import { PipeHorizontalBody } from './PipeHorizontalBody';
import { PipeHorizontalLip } from './PipeHorizontalLip';
import { PipeVerticalBody } from './PipeVerticalBody';
import { PipeVerticalLip } from './PipeVerticalLip';
import { PoisonMushroom } from './PoisonMushroom';
import { PWing } from './PWing';
import { RedCheepCheep } from './RedCheepCheep';
import { RegularVegetable } from './RegularVegetable';
import { SeeSawPivotPoint } from './SeeSawPivotPoint';
import { Shoe } from './Shoe';
import { SmallVegetable } from './SmallVegetable';
import { TanookiSuit } from './TanookiSuit';
import { ThreeNumberBlock } from './ThreeNumberBlock';
import { TiltPlatformBall } from './TiltPlatformBall';
import { TiltPlatformPivot } from './TiltPlatformPivot';
import { TwoNumberBlock } from './TwoNumberBlock';
import { UndergroundBackground } from './UndergroundBackground';
import { WaterfallTop } from './WaterfallTop';
import { WingedPlatformBlock } from './WingedPlatformBlock';
import { WingedPlatformWing } from './WingedPlatformWing';
import { WoodFloorTop } from './WoodFloorTop';
import { WoodPlatformLeft } from './WoodPlatformLeft';
import { WoodPlatformRight } from './WoodPlatformRight';

const resourceMap = {
	BigBooArm,
	BigBooBody,
	BigBooFace,
	BigBooTail,
	BoltNut,
	BoltShaft,
	BowserFireStatueBody,
	BowserFireStatueHead,
	ChargingChuckBody,
	ChargingChuckHead,
	ClimbingVineHead,
	CoinCache,
	CoinSnake,
	DoorLock,
	FlagPoleBall,
	FlagPoleShaft,
	FlutterBody,
	FlutterFlower,
	FlutterHead,
	FlutterWing,
	FortressBackground,
	FrogSuit,
	GrassHorizontalDirt,
	GiantVegetable,
	GreenCheepCheep,
	GreenSpinyEgg,
	HoppingBowserStatueBody,
	HoppingBowserStatueHead,
	HotHeadEyes,
	HorizontalDolphin,
	KoopalingWand,
	KoopaShell,
	OneNumberBlock,
	OneWayDoorHorizontalFlipper,
	OneWayDoorVerticalFlipper,
	OrangeSpinyEgg,
	ParaWing,
	PipeHorizontalBody,
	PipeHorizontalLip,
	PipeVerticalBody,
	PipeVerticalLip,
	PoisonMushroom,
	PWing,
	RedCheepCheep,
	RegularVegetable,
	SeeSawPivotPoint,
	Shoe,
	SmallVegetable,
	TanookiSuit,
	ThreeNumberBlock,
	TiltPlatformBall,
	TiltPlatformPivot,
	TwoNumberBlock,
	UndergroundBackground,
	WaterfallTop,
	WingedPlatformBlock,
	WingedPlatformWing,
	WoodFloorTop,
	WoodPlatformLeft,
	WoodPlatformRight,
};

type ResourceType = keyof typeof resourceMap;

export { resourceMap };
export type { ResourceType };
