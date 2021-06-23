import React from 'react';
import { useRouter } from 'next/router';
import { Provider } from 'react-redux';

import { MakePage } from '../../../components/make/MakePage';
import { store } from '../../../store';

function NextMakeIdPage() {
	const router = useRouter();

	const { id } = router.query;

	return (
		<Provider store={store}>
			<MakePage publishedLevelToLoad={id as string | undefined} />
		</Provider>
	);
}

export default NextMakeIdPage;
