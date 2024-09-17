// copied from https://github.com/evidence-dev/evidence/blob/main/packages/bigquery/index.cjs
const standardizeResult = async (result: any[]): Promise<any[]> => {
	var output = [];
	result.forEach((row) => {
		const standardized = {};
		for (const [key, value] of Object.entries(row)) {
			if (Array.isArray(value)) {
				standardized[key] = value.map((v) => {
					if (v['value']) {
						return v['value'];
					} else {
						return v;
					}
				});
			} else if (typeof value === 'object') {
				if (value) {
					if (value['value']) {
						standardized[key] = value['value'];
					} else {
						//This is a bigQuery specific workaround for https://github.com/evidence-dev/evidence/issues/792
						try {
							standardized[key] = Number(value);
						} catch (err) {
							standardized[key] = value;
						}
					}
				} else {
					standardized[key] = null;
				}
			} else {
				standardized[key] = value;
			}
		}
		output.push(standardized);
	});
	return output;
};

export {
    standardizeResult
}