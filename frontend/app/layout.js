export const metadata = {
  title: "Printed Parts Material Calc",
  description: "Filament cost + material estimate from STEP/STL files",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#0f1115", color: "#e6e6e6", margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
