export interface VirtualDevice {
    name: string;
    status: 'running' | 'offline';
    port?: number;
    pid?: number;
}
