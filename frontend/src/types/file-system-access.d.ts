interface FilePickerAcceptType {
	description?: string;
	accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
	multiple?: boolean;
	types?: FilePickerAcceptType[];
}

interface Window {
	showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
}
