import React from "react";

interface LoadingDotsProps {
	/** Optional className for additional styling */
	className?: string;
	/** Size of the dots (default: 3) */
	size?: number;
}

/**
 * LoadingDots component - Displays three animated bouncing dots
 * Used across the application for loading states
 */
export const LoadingDots: React.FC<LoadingDotsProps> = ({
	className = "",
	size = 3,
}) => {
	return (
		<div className={`flex items-center justify-center gap-2 ${className}`}>
			<div
				className="bg-brand-500 rounded-full"
				style={{
					width: `${size * 4}px`,
					height: `${size * 4}px`,
					animation: "bigBounce 0.6s ease-in-out 0s infinite",
				}}
			></div>
			<div
				className="bg-brand-500 rounded-full"
				style={{
					width: `${size * 4}px`,
					height: `${size * 4}px`,
					animation: "bigBounce 0.6s ease-in-out 0.15s infinite",
				}}
			></div>
			<div
				className="bg-brand-500 rounded-full"
				style={{
					width: `${size * 4}px`,
					height: `${size * 4}px`,
					animation: "bigBounce 0.6s ease-in-out 0.3s infinite",
				}}
			></div>
			{/* `transform: translateY(-16px);` increases the bounce height */}
			<style>{`
				@keyframes bigBounce {
					0%,
					100% {
						transform: translateY(0);
					}
					50% {
						transform: translateY(-16px);
					}
				}
			`}</style>
		</div>
	);
};
