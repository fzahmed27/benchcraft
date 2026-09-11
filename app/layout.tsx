import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Benchcraft — Your automation workbench',description:'Configure custom bench automation, review components and wiring, and export build plans for your next device.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
