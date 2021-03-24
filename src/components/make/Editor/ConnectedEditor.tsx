import React, { FunctionComponent } from 'react';
import { useSelector } from 'react-redux';

import { Editor, EditorProps } from './Editor';
import { AppState } from '../../../store';

type ConnectedEditorProps = Partial<EditorProps>;

const ConnectedEditor: FunctionComponent<ConnectedEditorProps> = (props) => {
	const { storedForResizeMode, loadLevelState } = useSelector(
		(state: AppState) => state.editor.present
	);

	return (
		<Editor
			resizeMode={!!storedForResizeMode}
			loadLevelState={loadLevelState}
			{...props}
		/>
	);
};

export { ConnectedEditor };
